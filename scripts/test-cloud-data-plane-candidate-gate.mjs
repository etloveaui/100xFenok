import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_GATE_SCHEMA,
  CANDIDATE_SCOPE_RECEIPT_SCHEMA,
  buildCandidateScopeReceipt,
  evaluateCandidateGate,
} from "./lib/cloud-data-plane-candidate-gate.mjs";
import { buildCloudDataPlaneReport } from "./lib/cloud-data-plane-budget.mjs";
import { collectBaseline } from "./collect-cloud-data-plane-account-baseline.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE = "stockanalysis_etf_detail";
const BASE = "1465331e474edbab7e5a26534632fdf640e4e5f0";
const MEASURED_AT = "2026-08-14T05:00:00Z";

const DEMAND = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "scripts", "fixtures", "cloud-data-plane", "etf-migration-demand.json"), "utf8"));

// Offline baseline, shaped after the 2026-08-14 observation. No live call.
async function fixtureBaseline() {
  const body = {
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
            { dimensions: { actionType: "DeleteObject" }, sum: { requests: 120 } },
          ],
          d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 696, writeQueries: 21, rowsRead: 4_393, rowsWritten: 43 } }],
          kvOperationsAdaptiveGroups: [
            { dimensions: { actionType: "read" }, sum: { requests: 730 } },
            { dimensions: { actionType: "write" }, sum: { requests: 30 } },
            { dimensions: { actionType: "list" }, sum: { requests: 20 } },
          ],
        }],
      },
    },
  };
  return collectBaseline(
    { accountTag: "test-account", since: "2026-08-01", until: "2026-08-14", monthDays: 30, scope: null, tables: ["publication_generations"], out: "/dev/null" },
    { transport: async () => body, token: "test-token" },
  );
}

const baseline = await fixtureBaseline();
const candidateReport = buildCloudDataPlaneReport({
  repoRoot: REPO_ROOT,
  candidateId: CANDIDATE,
  accountBaseline: baseline,
  requestDemand: DEMAND,
});
const estateReport = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, accountBaseline: baseline, requestDemand: DEMAND });

// --- receipt: binds base and time without touching the deterministic digest ---
{
  const receipt = buildCandidateScopeReceipt({ report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT, demand: DEMAND, accountBaseline: baseline });
  assert.equal(receipt.schema_version, CANDIDATE_SCOPE_RECEIPT_SCHEMA);
  assert.equal(receipt.candidate.id, CANDIDATE);
  assert.equal(receipt.candidate.enforcement, "shadow");
  assert.equal(receipt.base.commit, BASE);
  assert.ok(receipt.base.lane_registry_digest);
  assert.equal(receipt.scope.path_digest, candidateReport.candidate_scope.path_digest);
  assert.equal(receipt.scope.file_count, candidateReport.candidate_scope.totals.file_count);
  assert.equal(receipt.scope.bytes, candidateReport.candidate_scope.totals.bytes);
  assert.equal(receipt.measurement.measured_at, MEASURED_AT);
  assert.equal(receipt.measurement.mode, "live_filesystem");
  assert.ok(receipt.references.report_projection_digest && receipt.references.demand_digest && receipt.references.account_baseline_digest);
  assert.equal("report_digest" in receipt.references, false, "the raw-report reference was replaced by the receipt-free projection");
  // Projection policy is recorded so a later rebuilt->migrated change reads as a
  // policy change rather than an unexplained byte jump.
  assert.deepEqual(receipt.policy.projection_policy.map((row) => row.migrates), [false]);

  // The time-varying binding must not have leaked into the deterministic digest.
  const again = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, candidateId: CANDIDATE, accountBaseline: baseline, requestDemand: DEMAND });
  assert.equal(again.candidate_scope.path_digest, candidateReport.candidate_scope.path_digest);
  const laterReceipt = buildCandidateScopeReceipt({ report: again, baseCommit: BASE, measuredAt: "2026-08-15T06:00:00Z", demand: DEMAND, accountBaseline: baseline });
  assert.equal(laterReceipt.scope.path_digest, receipt.scope.path_digest, "the same tree must reproduce the same scope digest");
  assert.notEqual(laterReceipt.measurement.measured_at, receipt.measurement.measured_at);
}

// --- receipt fails closed ---
{
  assert.throws(() => buildCandidateScopeReceipt({ report: estateReport, baseCommit: BASE, measuredAt: MEASURED_AT }), /only defined for a candidate-scoped report/);
  assert.throws(() => buildCandidateScopeReceipt({ report: candidateReport, measuredAt: MEASURED_AT }), /baseCommit is required/);
  assert.throws(() => buildCandidateScopeReceipt({ report: candidateReport, baseCommit: BASE, measuredAt: "2026-08-14 05:00" }), /UTC timestamp/);
  assert.throws(() => buildCandidateScopeReceipt({ report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT, measurementMode: "guessed" }), /unsupported measurement mode/);
}

// --- gate reads the scoped budget verdict, not the combined report verdict ---
{
  const { computeCandidateContentDigest } = await import("./lib/cloud-data-plane-candidate-scope.mjs");
  const receipt = buildCandidateScopeReceipt({
    report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT,
    demand: DEMAND, accountBaseline: baseline,
    contentDigest: computeCandidateContentDigest({ repoRoot: REPO_ROOT, candidateId: CANDIDATE }),
    accountBaselineRawDigest: baseline.query.response_digest,
  });
  // expectedBase is supplied because the Phase 1 invocation must always supply
  // it; omitting it is a structural downgrade, covered separately below.
  const gate = evaluateCandidateGate({ report: candidateReport, receipt, demand: DEMAND, accountBaseline: baseline, expectedBase: BASE });
  assert.deepEqual(gate.inputs.receipt_failures, [], "a fully bound receipt must produce no named failures");
  assert.equal(gate.inputs.base_binding_enforced, true);
  assert.equal(gate.inputs.receipt_attests_payload_identity, true);
  assert.equal(gate.schema_version, CANDIDATE_GATE_SCHEMA);
  assert.equal(gate.candidate_id, CANDIDATE);
  assert.equal(gate.inputs.budget_verdict, "pass");
  assert.equal(gate.inputs.candidate_scope_complete, true);
  assert.equal(gate.inputs.retention_complete, true);
  assert.equal(gate.inputs.receipt_bound, true);
  assert.equal(gate.inputs.account_baseline_status, "verified");
  // Owner decision 2026-08-14: a candidate-scoped run is governed by the
  // candidate planning policy, which covers every metric this candidate uses.
  assert.equal(gate.inputs.planning_coverage_complete, true, "the candidate policy governs every metric the candidate uses");
  for (const row of gate.inputs.planning_coverage) assert.deepEqual(row.ungoverned, [], `${row.service} must be fully governed under the candidate policy`);
  assert.equal(gate.verdict, "pass");

  // The estate signals are carried and are NOT folded into the verdict. The
  // catalog is still incomplete, and the gate must neither be blocked by it nor
  // relabel it.
  assert.equal(gate.readiness_signals.estate_catalog_verdict, candidateReport.catalog.verdict);
  assert.equal(gate.readiness_signals.combined_report_verdict, candidateReport.verdict);
  assert.notEqual(candidateReport.catalog.verdict, "pass");
  assert.notEqual(candidateReport.verdict, "pass");
  assert.equal(gate.readiness_signals.estate_catalog_verdict, candidateReport.catalog.verdict, "the estate catalog is carried, never folded in");
}

// --- estate-scoped runs are refused, and stay unverified ---
{
  assert.throws(() => evaluateCandidateGate({ report: estateReport }), /refuses an estate-scoped report/);
  // With a baseline supplied the estate run is not merely unverified: its planning
  // line is measured and fails. The default estate-wide migration therefore stays
  // blocked on its own arithmetic, independently of the catalog gaps.
  assert.equal(estateReport.budget.r2.planning_line.verdict, "fail");
  assert.equal(estateReport.verdict, "fail");
  assert.notEqual(estateReport.catalog.verdict, "pass");
}

// --- every explicit input can independently hold the gate closed ---
{
  const { computeCandidateContentDigest } = await import("./lib/cloud-data-plane-candidate-scope.mjs");
  const content = computeCandidateContentDigest({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
  const fullReceipt = () => buildCandidateScopeReceipt({
    report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT,
    demand: DEMAND, accountBaseline: baseline,
    contentDigest: content, accountBaselineRawDigest: baseline.query.response_digest,
  });

  // No receipt: measurement is unbound, so the gate cannot pass.
  const none = evaluateCandidateGate({ report: candidateReport, demand: DEMAND, accountBaseline: baseline });
  assert.equal(none.verdict, "not_verified");
  assert.deepEqual(none.inputs.receipt_failures, ["receipt_absent"]);

  // Each field is enforced, not merely produced. Every tamper below must be
  // caught by name — a validator that fails for the wrong reason is not proof.
  const tampers = [
    ["schema_version", (r) => ({ ...r, schema_version: "candidate-scope-receipt/v0" })],
    ["candidate_id", (r) => ({ ...r, candidate: { ...r.candidate, id: "other_lane" } })],
    ["candidate_enforcement", (r) => ({ ...r, candidate: { ...r.candidate, enforcement: "live" } })],
    ["base_commit", (r) => ({ ...r, base: { ...r.base, commit: "" } })],
    ["base_lane_registry_digest", (r) => ({ ...r, base: { ...r.base, lane_registry_digest: "0".repeat(64) } })],
    ["scope_path_digest", (r) => ({ ...r, scope: { ...r.scope, path_digest: "0".repeat(64) } })],
    ["scope_file_count", (r) => ({ ...r, scope: { ...r.scope, file_count: r.scope.file_count - 1 } })],
    ["scope_bytes", (r) => ({ ...r, scope: { ...r.scope, bytes: r.scope.bytes - 1 } })],
    ["scope_included_roots", (r) => ({ ...r, scope: { ...r.scope, included_roots: [...r.scope.included_roots, "data/elsewhere"] } })],
    ["scope_excluded_paths", (r) => ({ ...r, scope: { ...r.scope, excluded_paths: r.scope.excluded_paths.slice(1) } })],
    ["contract_digest", (r) => ({ ...r, contract: { ...r.contract, digest: "0".repeat(64) } })],
    ["contract_sources", (r) => ({ ...r, contract: { ...r.contract, sources: ["cloud-data-plane-budget.mjs"] } })],
    ["report_projection_digest", (r) => ({ ...r, references: { ...r.references, report_projection_digest: "0".repeat(64) } })],
    ["demand_digest", (r) => ({ ...r, references: { ...r.references, demand_digest: "0".repeat(64) } })],
    ["account_baseline_digest", (r) => ({ ...r, references: { ...r.references, account_baseline_digest: "0".repeat(64) } })],
    ["baseline_raw_response_digest", (r) => ({ ...r, references: { ...r.references, account_baseline_raw_digest: "0".repeat(64) } })],
    ["payload_identity_mode", (r) => ({ ...r, payload_identity: { ...r.payload_identity, mode: "trust_me" } })],
    ["payload_identity_digest", (r) => ({ ...r, payload_identity: { mode: "content_sha256", digest: "short" } })],
    ["payload_identity_file_count", (r) => ({ ...r, payload_identity: { ...r.payload_identity, file_count: r.payload_identity.file_count - 1 } })],
    ["base_detection_config_digest", (r) => ({ ...r, base: { ...r.base, detection_config_digest: "0".repeat(64) } })],
    ["measurement_mode", (r) => ({ ...r, measurement: { ...r.measurement, mode: "assumed" } })],
    ["measurement_measured_at", (r) => ({ ...r, measurement: { ...r.measurement, measured_at: "2026-08-14 05:00" } })],
    ["scope_path_digest_basis", (r) => ({ ...r, scope: { ...r.scope, path_digest_basis: "content" } })],
    ["projection_policy", (r) => ({ ...r, policy: { ...r.policy, projection_policy: r.policy.projection_policy.map((row) => ({ ...row, migrates: true })) } })],
    ["scope_policy", (r) => ({ ...r, policy: { ...r.policy, scope_policy: "something-else/v1" } })],
  ];
  for (const [name, tamper] of tampers) {
    const gate = evaluateCandidateGate({ report: candidateReport, receipt: tamper(fullReceipt()), demand: DEMAND, accountBaseline: baseline });
    assert.equal(gate.inputs.receipt_bound, false, `${name} must not be accepted`);
    assert.ok(gate.inputs.receipt_failures.includes(name), `${name} must be reported by name, got ${gate.inputs.receipt_failures.join(",")}`);
    assert.equal(gate.verdict, "not_verified", `${name} must hold the gate closed`);
  }

  // A nonempty commit string is not a binding. When the caller knows the reviewed
  // base, only that base may satisfy the receipt.
  const rightBase = evaluateCandidateGate({ report: candidateReport, receipt: fullReceipt(), demand: DEMAND, accountBaseline: baseline, expectedBase: BASE });
  assert.equal(rightBase.inputs.receipt_bound, true);
  assert.equal(rightBase.inputs.base_binding_enforced, true);

  // Omitting the expected base is a structural downgrade, not an operating
  // choice: the gate refuses rather than trusting the caller to remember.
  const unbound = evaluateCandidateGate({ report: candidateReport, receipt: fullReceipt(), demand: DEMAND, accountBaseline: baseline });
  assert.equal(unbound.inputs.receipt_bound, true, "the receipt itself is still internally consistent");
  assert.equal(unbound.inputs.base_binding_enforced, false);
  assert.equal(unbound.verdict, "not_verified", "an unbound base must hold the gate closed on its own");
  const wrongBase = evaluateCandidateGate({ report: candidateReport, receipt: fullReceipt(), demand: DEMAND, accountBaseline: baseline, expectedBase: "f".repeat(40) });
  assert.equal(wrongBase.inputs.receipt_bound, false);
  assert.ok(wrongBase.inputs.receipt_failures.includes("base_commit_expected"));
  assert.equal(wrongBase.verdict, "not_verified");

  // A size-only receipt is acceptable for a size gate but must never be read as
  // attesting content.
  const sizeOnly = buildCandidateScopeReceipt({
    report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT,
    demand: DEMAND, accountBaseline: baseline, accountBaselineRawDigest: baseline.query.response_digest,
  });
  const sizeOnlyGate = evaluateCandidateGate({ report: candidateReport, receipt: sizeOnly, demand: DEMAND, accountBaseline: baseline });
  assert.equal(sizeOnlyGate.inputs.receipt_bound, true);
  assert.equal(sizeOnlyGate.inputs.receipt_attests_payload_identity, false);

  // A verified baseline whose query provenance is missing cannot be bound.
  const strippedBaseline = { ...baseline };
  delete strippedBaseline.query;
  const strippedGate = evaluateCandidateGate({ report: candidateReport, receipt: fullReceipt(), demand: DEMAND, accountBaseline: strippedBaseline });
  assert.equal(strippedGate.inputs.receipt_bound, false);
  assert.ok(strippedGate.inputs.receipt_failures.includes("baseline_query_account_tag"));

  // No account baseline: retention and budget both degrade, gate stays closed.
  const noBaseline = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, candidateId: CANDIDATE, requestDemand: DEMAND });
  const noBaselineGate = evaluateCandidateGate({
    report: noBaseline, demand: DEMAND,
    receipt: buildCandidateScopeReceipt({ report: noBaseline, baseCommit: BASE, measuredAt: MEASURED_AT, demand: DEMAND }),
  });
  assert.equal(noBaselineGate.inputs.account_baseline_status, "not_verified");
  assert.equal(noBaselineGate.verdict, "not_verified");

  // No retention declaration: the delete branch is incomplete and holds it closed.
  const noDelete = JSON.parse(JSON.stringify(DEMAND));
  delete noDelete.r2.class_a.delete;
  const noDeleteReport = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, candidateId: CANDIDATE, accountBaseline: baseline, requestDemand: noDelete });
  const noDeleteGate = evaluateCandidateGate({
    report: noDeleteReport, demand: noDelete, accountBaseline: baseline,
    receipt: buildCandidateScopeReceipt({
      report: noDeleteReport, baseCommit: BASE, measuredAt: MEASURED_AT,
      demand: noDelete, accountBaseline: baseline, accountBaselineRawDigest: baseline.query.response_digest,
    }),
  });
  assert.equal(noDeleteGate.inputs.retention_complete, false);
  assert.equal(noDeleteGate.verdict, "not_verified");
}

// --- the three evidence bindings the verifier required ---
{
  const { computeCandidateContentDigest } = await import("./lib/cloud-data-plane-candidate-scope.mjs");
  const { contractDigest, reportProjection } = await import("./lib/cloud-data-plane-candidate-gate.mjs");

  // Without a content digest the receipt must SAY it does not attest content,
  // rather than leaving the field blank and letting a reader assume it does.
  const bare = buildCandidateScopeReceipt({ report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT });
  assert.equal(bare.payload_identity.mode, "budget_scope_only");
  assert.equal(bare.payload_identity.digest, null);
  assert.match(bare.payload_identity.note, /does not attest payload content identity/);
  assert.equal(bare.scope.path_digest_basis, "relative_path_and_byte_size");
  assert.equal(bare.references.account_baseline_raw_digest, null);

  // With one, it carries content identity that a same-size swap would change.
  const content = computeCandidateContentDigest({ repoRoot: REPO_ROOT, candidateId: CANDIDATE });
  assert.equal(content.mode, "content_sha256");
  assert.equal(content.file_count, candidateReport.candidate_scope.totals.file_count);
  const bound = buildCandidateScopeReceipt({
    report: candidateReport, baseCommit: BASE, measuredAt: MEASURED_AT,
    demand: DEMAND, accountBaseline: baseline,
    contentDigest: content, accountBaselineRawDigest: baseline.query.response_digest,
  });
  assert.equal(bound.payload_identity.mode, "content_sha256");
  assert.equal(bound.payload_identity.digest, content.digest);
  assert.notEqual(bound.payload_identity.digest, bound.scope.path_digest);
  assert.equal(bound.references.account_baseline_raw_digest, baseline.query.response_digest);

  // Contract digest identifies the code, and changes when the code changes.
  assert.equal(bound.contract.digest, contractDigest());
  assert.deepEqual(bound.contract.sources, [
    "cloud-data-plane-candidate-scope.mjs",
    "cloud-data-plane-candidate-gate.mjs",
    "cloud-data-plane-budget.mjs",
  ]);
  assert.match(bound.contract.digest, /^[0-9a-f]{64}$/);

  // The report reference is over a receipt-free projection, so attaching the
  // receipt and gate to a bundle cannot change what the receipt claims.
  const projection = reportProjection(candidateReport);
  assert.equal("candidate_scope" in projection, false);
  assert.equal("receipt" in projection, false);
  const withAttachments = { ...candidateReport, receipt: bound, gate: evaluateCandidateGate({ report: candidateReport, receipt: bound }) };
  const reReceipt = buildCandidateScopeReceipt({
    report: withAttachments, baseCommit: BASE, measuredAt: MEASURED_AT,
    demand: DEMAND, accountBaseline: baseline,
    contentDigest: content, accountBaselineRawDigest: baseline.query.response_digest,
  });
  assert.equal(
    reReceipt.references.report_projection_digest,
    bound.references.report_projection_digest,
    "attaching the receipt and gate to the report must not move the reference digest",
  );

  // The collector freezes which measurement the numbers came from.
  assert.deepEqual(
    { account_tag: baseline.query.account_tag, since: baseline.query.since, until: baseline.query.until },
    { account_tag: "test-account", since: "2026-08-01", until: "2026-08-14" },
  );
  assert.match(baseline.query.response_digest, /^[0-9a-f]{64}$/);
  assert.equal(baseline.query.response_digest_basis, "sha256_of_canonical_json_of_parsed_response");
}

process.stdout.write("test-cloud-data-plane-candidate-gate: ok\n");
